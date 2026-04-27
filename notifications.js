/**
 * TechTitans Notification System
 * Handles browser-level push notifications
 */

const TechTitansNotifications = {
  /**
   * Request permission for notifications
   */
  async requestPermission() {
    if (!("Notification" in window)) {
      console.warn("This browser does not support desktop notifications");
      return false;
    }

    if (Notification.permission === "granted") {
      return true;
    }

    if (Notification.permission !== "denied") {
      const permission = await Notification.requestPermission();
      return permission === "granted";
    }

    return false;
  },

  /**
   * Display a notification
   * @param {string} title - Notification title
   * @param {Object} options - Notification options (body, icon, etc.)
   */
  async display(title, options = {}) {
    // Check if tab is already focused - don't distract if user is already here
    if (document.hasFocus()) {
      return null;
    }

    if (Notification.permission === "granted") {
      const defaultOptions = {
        icon: 'img/titans_logo2.png', // Fallback to logo
        badge: 'img/titans_logo2.png',
        silent: false,
        vibrate: [100, 50, 100]
      };

      const finalOptions = { ...defaultOptions, ...options };
      const notification = new Notification(title, finalOptions);

      notification.onclick = function(event) {
        event.preventDefault(); // prevent the browser from focusing the Notification's tab
        window.focus();
        notification.close();
        
        // If there's a target URL, redirect
        if (options.url) {
          window.location.href = options.url;
        }
      };

      return notification;
    }
    return null;
  }
};

// Auto-request permission on certain pages if not already prompted
if (window.location.pathname.includes('dashboard.html') || 
    window.location.pathname.includes('dm.html') || 
    window.location.pathname.includes('messages.html')) {
  // Wait for user interaction to avoid browser blocking auto-popups if possible
  document.addEventListener('click', () => {
    if (Notification.permission === 'default') {
      TechTitansNotifications.requestPermission();
    }
  }, { once: true });
}

window.TechTitansNotifications = TechTitansNotifications;
