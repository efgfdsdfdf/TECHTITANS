/**
 * TechTitans Global Notification Manager
 * Loaded on EVERY authenticated page to provide:
 *  - Incoming DM call overlay (ringing, accept/decline) on any page
 *  - Group call started/ended toasts on any page
 *  - Announcement push display on any page
 *  - Service worker message relay (for push-triggered call events)
 *
 * Depends on: notifications.js, ringtone.js (optional), supabase client
 */
const TechTitansGlobal = {
  _supabase: null,
  _userId: null,
  _userFullName: 'User',
  _userRole: null,
  _isCEO: false,
  _initialized: false,
  _userChannel: null,
  _groupCallChannel: null,
  _announcementChannel: null,
  _callOverlay: null,
  _pendingCall: null,
  _callActive: false,
  _callTimeout: null,
  _onDmPage: false,
  _onMessagesPage: false,

  async init(supabase) {
    if (this._initialized) return;
    if (!supabase || !supabase.from) return;

    this._supabase = supabase;
    this._onDmPage = window.location.pathname.includes('dm.html');
    this._onMessagesPage = window.location.pathname.includes('messages.html');

    const { data, error } = await supabase.auth.getUser();
    if (error || !data?.user) return;

    this._userId = data.user.id;

    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, role, job_role')
        .eq('id', this._userId)
        .single();

      if (profile) {
        this._userFullName = profile.full_name || 'User';
        this._userRole = profile.job_role || profile.role || null;
        this._isCEO = (profile.role === 'admin' || profile.job_role === 'CEO');
      }
    } catch (err) {
      console.warn('Global notifications: unable to load profile', err);
    }

    this._initialized = true;
    this._injectOverlayStyles();
    this._createCallOverlay();
    this._setupUserChannel();
    this._setupGroupCallListener();
    this._setupAnnouncementListener();
    this._setupGlobalDmBadge();
    this._setupServiceWorkerRelay();
    this._setupGlobalPresence();
  },

  // ─── User broadcast channel (incoming DM calls) ───────────────────

  _setupUserChannel() {
    if (!this._supabase || !this._userId) return;

    // On dm.html, the page itself handles call-offer. We still listen
    // for service-worker-relayed events but skip broadcast duplicates.
    if (this._onDmPage) return;

    this._userChannel = this._supabase
      .channel(`user-${this._userId}`)
      .on('broadcast', { event: 'call-offer' }, ({ payload }) => {
        this._handleIncomingCall(payload);
      })
      .on('broadcast', { event: 'call-ended' }, ({ payload }) => {
        this._handleCallEnded(payload);
      })
      .on('broadcast', { event: 'call-missed' }, ({ payload }) => {
        this._handleCallEnded(payload);
      })
      .subscribe();
  },

  // ─── Group call listener ──────────────────────────────────────────

  _setupGroupCallListener() {
    if (!this._supabase || !this._userRole) return;
    // On messages.html the page handles its own group call subscription
    if (this._onMessagesPage) return;

    this._groupCallChannel = this._supabase
      .channel(`global-group-call-${this._userRole}`)
      .on('broadcast', { event: 'group-call-started' }, ({ payload }) => {
        if (!payload || payload.callerId === this._userId) return;
        const callerName = payload.callerName || 'Someone';
        this._showToast(`📞 Group call started by ${callerName}`, 'info');

        if (window.TechTitansNotifications) {
          window.TechTitansNotifications.display(`Group call started`, {
            body: `${callerName} started a group call for ${this._userRole}. Tap to join.`,
            url: 'messages.html',
            tag: 'group-call-started',
            requireInteraction: true
          });
        }
      })
      .on('broadcast', { event: 'group-call-ended' }, ({ payload }) => {
        if (!payload || payload.endedBy === this._userId) return;
        this._showToast('Group call ended', 'info');
      })
      .subscribe();
  },

  // ─── Announcement listener ────────────────────────────────────────

  _setupAnnouncementListener() {
    if (!this._supabase || !this._userId) return;

    this._announcementChannel = this._supabase
      .channel('global-announcements')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'announcements'
      }, async ({ new: announcement }) => {
        if (!announcement) return;
        if (announcement.created_by === this._userId) return;

        const content = announcement.content || 'View the latest announcement';
        const preview = content.length > 100 ? content.substring(0, 100) + '...' : content;
        this._showToast(`📢 New announcement: ${preview}`, 'announcement');

        if (window.TechTitansNotifications?.displayAnnouncement) {
          window.TechTitansNotifications.displayAnnouncement(
            'New Announcement',
            preview,
            { url: 'dashboard.html' }
          );
        }
      })
      .subscribe();
  },

  // ─── Global DM Badge listener ─────────────────────────────────────

  async _setupGlobalDmBadge() {
    if (!this._supabase || !this._userId) return;

    const updateGlobalBadge = (count) => {
      const badge1 = document.getElementById('globalDmUnreadBadge');
      const badge2 = document.getElementById('dmUnreadBadge'); // If on dm.html
      [badge1, badge2].forEach(b => {
        if (b) {
          if (count > 0) {
            b.style.display = 'inline-block';
            b.textContent = count;
          } else {
            b.style.display = 'none';
          }
        }
      });
    };

    const fetchUnread = async () => {
      try {
        const { count, error } = await this._supabase
          .from('private_messages')
          .select('*', { count: 'exact', head: true })
          .eq('recipient_id', this._userId)
          .is('read_at', null);
        if (!error && count !== null) {
          updateGlobalBadge(count);
        }
      } catch (e) {}
    };

    // Initial fetch
    await fetchUnread();

    // Listen for changes (new messages or marked as read)
    this._supabase.channel('global-dm-badge')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'private_messages',
        filter: `recipient_id=eq.${this._userId}`
      }, () => {
        // Debounce fetch slightly to prevent spam
        if (this._dmBadgeTimeout) clearTimeout(this._dmBadgeTimeout);
        this._dmBadgeTimeout = setTimeout(() => fetchUnread(), 500);
      })
      .subscribe();
  },

  // ─── Service Worker message relay ─────────────────────────────────

  _setupServiceWorkerRelay() {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.addEventListener('message', (event) => {
      const data = event.data;
      if (!data || !data.type) return;

      if (data.type === 'incoming_call') {
        this._handleIncomingCall({
          callerId: data.callerId,
          callerName: data.callerName,
          callType: data.callType,
          callId: data.callId,
          roomId: data.roomId
        });
      }

      if (data.type === 'call_accepted_from_notification') {
        // User tapped "accept" on the OS notification
        this._dismissCallOverlay();
        if (this._onDmPage && window.acceptDMCallFromNotification) {
          window.acceptDMCallFromNotification(data);
        } else {
          window.location.href = `dm.html?callId=${encodeURIComponent(data.callId)}&nativeAccepted=1`;
        }
      }

      if (data.type === 'call_declined_from_notification') {
        // User tapped "decline" on the OS notification
        if (this._onDmPage && window.declineDMCallFromNotification) {
          window.declineDMCallFromNotification(data);
        } else {
          this._pendingCall = this._pendingCall || {
            callId: data.callId,
            callerId: data.callerId,
            callType: data.callType
          };
          this._declineCall();
        }
      }

      if (data.type === 'call_notification_dismissed' || data.type === 'call_cancelled') {
        this._dismissCallOverlay();
      }
    });
  },

  // ─── Global Presence tracking ───────────────────────────────────────
  
  _setupGlobalPresence() {
    if (!this._supabase || !this._userId) return;
    
    // We track presence on a global level so users appear online on any page.
    const presenceChannel = this._supabase.channel('online-users', { 
      config: { presence: { key: this._userId } } 
    });
    
    presenceChannel.on('presence', { event: 'sync' }, () => {
      // We don't necessarily need to render online users on every page,
      // just being subscribed and tracked makes the user show as online to others!
    }).subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await presenceChannel.track({ 
          userId: this._userId, 
          name: this._userFullName, 
          role: this._userRole, 
          online_at: new Date().toISOString() 
        });
      }
    });
    
    this._globalPresenceChannel = presenceChannel;
  },

  // ─── Incoming call handling ───────────────────────────────────────

  _handleIncomingCall(payload) {
    if (!payload) return;
    if (this._callActive || this._pendingCall) return;
    if (payload.callerId === this._userId) return;

    // On dm.html the page itself handles this
    if (this._onDmPage) return;

    this._pendingCall = {
      callerId: payload.callerId,
      callerName: payload.callerName || 'Someone',
      callType: payload.callType || 'voice',
      callId: payload.callId,
      callChannelName: payload.callChannelName,
      roomId: payload.roomId
    };

    this._showCallOverlay(this._pendingCall);

    // Play ringtone
    if (window.TechTitansRingtone) {
      window.TechTitansRingtone.start();
    }

    // Show browser notification
    if (window.TechTitansNotifications?.displayCall) {
      window.TechTitansNotifications.displayCall(
        this._pendingCall.callerName,
        this._pendingCall.callType,
        { callId: this._pendingCall.callId, url: 'dm.html' }
      );
    }

    // Auto-timeout after 45 seconds
    this._callTimeout = setTimeout(() => {
      this._handleCallMissed();
    }, 45000);
  },

  _handleCallEnded(payload) {
    if (!this._pendingCall) return;
    if (payload?.callId && this._pendingCall.callId && payload.callId !== this._pendingCall.callId) return;
    this._dismissCallOverlay();
  },

  _handleCallMissed() {
    if (!this._pendingCall) return;
    const call = this._pendingCall;
    const callId = call.callId;

    this._dismissCallOverlay();
    this._showToast('📵 Missed call', 'warning');

    // Show a push notification that routes to calls.html
    if (window.TechTitansNotifications) {
      window.TechTitansNotifications.display(`Missed call from ${call.callerName || 'Someone'}`, {
        body: `You missed a ${call.callType === 'video' ? 'video' : 'voice'} call. Tap to view call logs.`,
        url: 'calls.html',
        tag: `missed-call-${callId || Date.now()}`
      });
    }

    // Cancel the ringing OS notification
    if (window.TechTitansNotifications?.cancelCallNotification) {
      window.TechTitansNotifications.cancelCallNotification(callId);
    }
  },

  _acceptCall() {
    if (!this._pendingCall) return;
    const call = this._pendingCall;
    this._dismissCallOverlay();

    const params = new URLSearchParams({
      callId: call.callId || '',
      nativeAccepted: '1',
      callType: call.callType || 'voice',
      iframeMode: '1'
    });
    
    const url = `dm.html?${params.toString()}`;

    if (this._onDmPage) {
      window.location.href = url;
    } else {
      this._createCallIframe(url);
    }
  },

  _createCallIframe(url) {
    if (this._callIframe) return;
    
    const container = document.createElement('div');
    container.id = 'globalCallIframeContainer';
    container.innerHTML = `
      <div id="iframeCallLoader" style="position:absolute;top:0;left:0;width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#0b0f17;z-index:10;">
        <div style="width:40px;height:40px;border:3px solid #1f2a44;border-top-color:#428cff;border-radius:50%;animation:spin 0.8s linear infinite;"></div>
        <p style="color:#9aa4bf;margin-top:1rem;font-size:0.9rem;">Connecting call…</p>
      </div>
      <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
      <iframe src="${url}" allow="camera; microphone; display-capture" style="width: 100%; height: 100%; border: none;"></iframe>
    `;
    
    document.body.appendChild(container);
    this._callIframeContainer = container;

    // Remove loader once iframe has loaded
    const iframe = container.querySelector('iframe');
    if (iframe) {
      iframe.addEventListener('load', () => {
        const loader = container.querySelector('#iframeCallLoader');
        if (loader) loader.remove();
      });
    }

    // Listen for postMessage from iframe to destroy it
    this._iframeMessageListener = (event) => {
      if (event.data && event.data.type === 'call-ended') {
        this._destroyCallIframe();
      }
    };
    window.addEventListener('message', this._iframeMessageListener);
  },

  _destroyCallIframe() {
    if (this._callIframeContainer) {
      this._callIframeContainer.remove();
      this._callIframeContainer = null;
    }
    if (this._iframeMessageListener) {
      window.removeEventListener('message', this._iframeMessageListener);
      this._iframeMessageListener = null;
    }
  },

  _declineCall() {
    if (!this._pendingCall) return;
    const call = this._pendingCall;
    this._dismissCallOverlay();

    // Record the decline so the caller's realtime subscription and call logs see it
    if (this._supabase && call.callId) {
      this._supabase.from('call_participants')
        .update({ status: 'declined' })
        .eq('call_id', call.callId)
        .eq('user_id', this._userId)
        .then(() => {}, () => {});
    }

    // Notify caller that call was declined
    if (this._supabase && call.callerId) {
      const channel = this._supabase.channel(`user-${call.callerId}`);
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          channel.send({
            type: 'broadcast',
            event: 'call-missed',
            payload: {
              callId: call.callId,
              missedBy: this._userId,
              callType: call.callType,
              calleeName: this._userFullName,
              reason: 'declined'
            }
          });
          setTimeout(() => { try { channel.unsubscribe(); } catch (e) {} }, 500);
        }
      });
    }

    // Cancel OS notification
    if (window.TechTitansNotifications?.cancelCallNotification) {
      window.TechTitansNotifications.cancelCallNotification(call.callId);
    }
  },

  _dismissCallOverlay() {
    if (window.TechTitansRingtone) {
      window.TechTitansRingtone.stop();
    }
    if (this._callTimeout) {
      clearTimeout(this._callTimeout);
      this._callTimeout = null;
    }
    this._pendingCall = null;
    if (this._callOverlay) {
      this._callOverlay.style.display = 'none';
    }
  },

  // ─── Call overlay UI ──────────────────────────────────────────────

  _createCallOverlay() {
    if (this._callOverlay) return;

    const overlay = document.createElement('div');
    overlay.id = 'globalIncomingCallOverlay';
    overlay.innerHTML = `
      <div class="gn-call-card">
        <div class="gn-call-pulse"></div>
        <div class="gn-call-icon">📞</div>
        <h2 class="gn-call-caller" id="gnCallCallerName">Someone</h2>
        <p class="gn-call-type" id="gnCallType">Voice call</p>
        <div class="gn-call-actions">
          <button class="gn-call-accept" id="gnCallAccept">
            <span>✓</span> Accept
          </button>
          <button class="gn-call-decline" id="gnCallDecline">
            <span>✕</span> Decline
          </button>
        </div>
      </div>
    `;
    overlay.style.display = 'none';
    document.body.appendChild(overlay);
    this._callOverlay = overlay;

    document.getElementById('gnCallAccept').addEventListener('click', () => this._acceptCall());
    document.getElementById('gnCallDecline').addEventListener('click', () => this._declineCall());
  },

  _showCallOverlay(call) {
    if (!this._callOverlay) return;
    document.getElementById('gnCallCallerName').textContent = call.callerName || 'Someone';
    document.getElementById('gnCallType').textContent =
      (call.callType === 'video' ? 'Video' : 'Voice') + ' call';
    this._callOverlay.style.display = 'flex';
  },

  // ─── Toast notifications ─────────────────────────────────────────

  _showToast(message, type = 'info') {
    // Use existing showToast if available on the page
    if (typeof window.showToast === 'function') {
      window.showToast(message);
      return;
    }

    const toast = document.createElement('div');
    toast.className = 'gn-toast';
    toast.textContent = message;
    if (type === 'warning') toast.style.borderColor = '#ff9f43';
    if (type === 'announcement') toast.style.borderColor = '#428cff';
    document.body.appendChild(toast);

    requestAnimationFrame(() => { toast.classList.add('gn-toast-visible'); });
    setTimeout(() => {
      toast.classList.remove('gn-toast-visible');
      setTimeout(() => toast.remove(), 400);
    }, 5000);
  },

  // ─── Styles ───────────────────────────────────────────────────────

  _injectOverlayStyles() {
    if (document.getElementById('gnOverlayStyles')) return;

    const style = document.createElement('style');
    style.id = 'gnOverlayStyles';
    style.textContent = `
      #globalIncomingCallOverlay {
        position: fixed;
        inset: 0;
        z-index: 99999;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0, 0, 0, 0.85);
        backdrop-filter: blur(12px);
        animation: gnFadeIn 0.3s ease;
      }
      #globalCallIframeContainer {
        position: fixed;
        inset: 0;
        z-index: 999999;
        background: #0b0f17;
      }
      @keyframes gnFadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      .gn-call-card {
        text-align: center;
        padding: 3rem 2.5rem;
        border-radius: 2rem;
        background: linear-gradient(145deg, rgba(15, 25, 50, 0.95), rgba(8, 14, 32, 0.98));
        border: 1px solid rgba(66, 140, 255, 0.2);
        box-shadow: 0 30px 80px rgba(0, 0, 0, 0.5), 0 0 60px rgba(66, 140, 255, 0.08);
        max-width: 380px;
        width: 90%;
        position: relative;
      }
      .gn-call-pulse {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 120px;
        height: 120px;
        border-radius: 50%;
        background: rgba(66, 140, 255, 0.08);
        animation: gnPulse 2s ease-in-out infinite;
      }
      @keyframes gnPulse {
        0%, 100% { transform: translate(-50%, -50%) scale(1); opacity: 0.6; }
        50% { transform: translate(-50%, -50%) scale(1.6); opacity: 0; }
      }
      .gn-call-icon {
        font-size: 3rem;
        margin-bottom: 1.2rem;
        animation: gnRing 1.2s ease-in-out infinite;
        position: relative;
        z-index: 1;
      }
      @keyframes gnRing {
        0%, 100% { transform: rotate(0deg); }
        10% { transform: rotate(15deg); }
        20% { transform: rotate(-15deg); }
        30% { transform: rotate(10deg); }
        40% { transform: rotate(-10deg); }
        50% { transform: rotate(0deg); }
      }
      .gn-call-caller {
        color: #fff;
        font-size: 1.6rem;
        font-weight: 700;
        margin: 0 0 0.4rem;
        font-family: Inter, system-ui, sans-serif;
        position: relative;
        z-index: 1;
      }
      .gn-call-type {
        color: #9aa4bf;
        font-size: 1rem;
        margin: 0 0 2rem;
        font-family: Inter, system-ui, sans-serif;
        position: relative;
        z-index: 1;
      }
      .gn-call-actions {
        display: flex;
        gap: 1.2rem;
        justify-content: center;
        position: relative;
        z-index: 1;
      }
      .gn-call-accept,
      .gn-call-decline {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        padding: 1rem 2rem;
        border: none;
        border-radius: 999px;
        font-size: 1rem;
        font-weight: 700;
        cursor: pointer;
        transition: transform 0.2s ease, box-shadow 0.2s ease;
        font-family: Inter, system-ui, sans-serif;
      }
      .gn-call-accept {
        background: linear-gradient(135deg, #38d7a8, #28b88c);
        color: #fff;
        box-shadow: 0 4px 20px rgba(56, 215, 168, 0.3);
      }
      .gn-call-accept:hover {
        transform: scale(1.05);
        box-shadow: 0 6px 28px rgba(56, 215, 168, 0.45);
      }
      .gn-call-decline {
        background: linear-gradient(135deg, #ff4d4d, #e63939);
        color: #fff;
        box-shadow: 0 4px 20px rgba(255, 77, 77, 0.3);
      }
      .gn-call-decline:hover {
        transform: scale(1.05);
        box-shadow: 0 6px 28px rgba(255, 77, 77, 0.45);
      }
      .gn-call-accept span,
      .gn-call-decline span {
        font-size: 1.2rem;
      }
      .gn-toast {
        position: fixed;
        bottom: 2rem;
        left: 50%;
        transform: translateX(-50%) translateY(20px);
        background: rgba(8, 14, 32, 0.95);
        color: #eef2fb;
        padding: 0.9rem 1.6rem;
        border-radius: 999px;
        border: 1px solid rgba(66, 140, 255, 0.2);
        font-size: 0.95rem;
        font-family: Inter, system-ui, sans-serif;
        font-weight: 500;
        z-index: 99998;
        opacity: 0;
        transition: opacity 0.35s ease, transform 0.35s ease;
        backdrop-filter: blur(12px);
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
        max-width: min(400px, calc(100vw - 2rem));
        text-align: center;
      }
      .gn-toast-visible {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }
      @media (max-width: 480px) {
        .gn-call-card { padding: 2rem 1.5rem; }
        .gn-call-caller { font-size: 1.3rem; }
        .gn-call-actions { flex-direction: column; gap: 0.8rem; }
        .gn-call-accept, .gn-call-decline { width: 100%; justify-content: center; }
      }
    `;
    document.head.appendChild(style);
  },

  // ─── Cleanup ──────────────────────────────────────────────────────

  destroy() {
    if (this._userChannel) {
      try { this._userChannel.unsubscribe(); } catch (e) {}
      this._userChannel = null;
    }
    if (this._groupCallChannel) {
      try { this._groupCallChannel.unsubscribe(); } catch (e) {}
      this._groupCallChannel = null;
    }
    if (this._announcementChannel) {
      try { this._announcementChannel.unsubscribe(); } catch (e) {}
      this._announcementChannel = null;
    }
    if (this._globalPresenceChannel) {
      try { this._globalPresenceChannel.unsubscribe(); } catch (e) {}
      this._globalPresenceChannel = null;
    }
    this._dismissCallOverlay();
    this._destroyCallIframe();
    this._initialized = false;
  }
};

window.TechTitansGlobal = TechTitansGlobal;

// Auto-initialize when supabase client is detected
document.addEventListener('DOMContentLoaded', () => {
  const checkInterval = setInterval(() => {
    // Look for the supabase client created by page scripts
    const supabaseClient = window._supabaseClient || window.supabase?.__supabaseClient;
    if (supabaseClient) {
      clearInterval(checkInterval);
      TechTitansGlobal.init(supabaseClient);
      return;
    }
    // Fallback: if TechTitansNotifications is connected, use its client
    if (window.TechTitansNotifications?._supabase) {
      clearInterval(checkInterval);
      TechTitansGlobal.init(window.TechTitansNotifications._supabase);
    }
  }, 500);

  // Stop checking after 15 seconds
  setTimeout(() => clearInterval(checkInterval), 15000);
});
