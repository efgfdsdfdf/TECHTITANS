(function() {
  const SUPABASE_URL = 'https://mdqqtsdibtvymfgntstf.supabase.co';
  const REGISTER_RETRY_MS = 1200;
  let lastRegisteredAccessToken = null;
  let registerTimer = null;

  function getNativePlugin() {
    return window.Capacitor?.Plugins?.TechTitansCall || null;
  }

  function isNativeApp() {
    return Boolean(window.Capacitor?.isNativePlatform?.() && getNativePlugin());
  }

  async function registerNativeDevice(supabaseClient) {
    if (!isNativeApp() || !supabaseClient?.auth) return;

    try {
      const { data } = await supabaseClient.auth.getSession();
      const accessToken = data?.session?.access_token;
      if (!accessToken || accessToken === lastRegisteredAccessToken) return;

      await getNativePlugin().registerCallDevice({
        supabaseUrl: SUPABASE_URL,
        accessToken
      });
      lastRegisteredAccessToken = accessToken;
      console.info('Native call device registration completed');
    } catch (error) {
      console.warn('Native call device registration failed:', error);
    }
  }

  function scheduleRegistration(supabaseClient) {
    if (registerTimer) clearTimeout(registerTimer);
    registerTimer = setTimeout(() => registerNativeDevice(supabaseClient), REGISTER_RETRY_MS);
  }

  function hookSupabaseCreateClient() {
    if (!window.supabase?.createClient || window.supabase.__techTitansNativeHooked) return;
    const originalCreateClient = window.supabase.createClient.bind(window.supabase);
    window.supabase.createClient = function(...args) {
      const client = originalCreateClient(...args);
      scheduleRegistration(client);
      try {
        client.auth.onAuthStateChange((_event, session) => {
          if (session?.access_token) scheduleRegistration(client);
          else lastRegisteredAccessToken = null;
        });
      } catch (error) {
        console.warn('Unable to subscribe native auth registration:', error);
      }
      return client;
    };
    window.supabase.__techTitansNativeHooked = true;
  }

  function handleNativeCallEvent(event) {
    const detail = event.detail || {};
    if (!detail.callId) return;

    if (detail.event === 'incomingCallAccepted') {
      const params = new URLSearchParams({
        callId: detail.callId,
        nativeAccepted: '1'
      });
      if (detail.callType) params.set('callType', detail.callType);
      window.location.href = `dm.html?${params.toString()}`;
    }
  }

  async function consumePendingNativeCall() {
    if (!isNativeApp()) return;
    try {
      const pending = await getNativePlugin().getPendingCallAction();
      if (pending?.callId) {
        handleNativeCallEvent({ detail: pending });
      }
    } catch (error) {
      console.warn('Unable to read pending native call action:', error);
    }
  }

  async function consumePendingNativeNotification() {
    if (!isNativeApp()) return;
    try {
      const pending = await getNativePlugin().getPendingNotificationAction();
      if (pending?.url) {
        window.location.href = pending.url;
      }
    } catch (error) {
      console.warn('Unable to read pending native notification action:', error);
    }
  }

  window.TechTitansNativeBridge = {
    registerNativeDevice,
    isNativeApp,
    consumePendingNativeCall,
    consumePendingNativeNotification
  };

  window.addEventListener('techtitansNativeCall', handleNativeCallEvent);
  hookSupabaseCreateClient();
  document.addEventListener('DOMContentLoaded', () => {
    consumePendingNativeCall();
    consumePendingNativeNotification();
  });
})();
